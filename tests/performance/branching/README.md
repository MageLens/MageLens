<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Branching performance matrix

This matrix measures actual authenticated Luma checkout journeys using the
ordinary native runner and the AUTO orchestrator. Both execute the same generated
test source. There are no forced checkpoints, fixed delays, test-specific weights or
handwritten checkpoint execution adapters.

Each journey logs in, adds products, verifies the cart, selects shipping, places
an order, and verifies the saved items and total. Variants include no coupon,
percentage discounts, an invalid coupon and a free order. The customer, address
and customer group stay the same. The fixed fixture uses 80 simple products and
seven coupon rules; it is not a large-production-database benchmark.

| Row | Products per cart | Tests | Purpose |
| --- | ---: | ---: | --- |
| `short-5` | 1 | 5 | Reject small repeated work |
| `reuse-2` | 8 | 2 | Check the effect of low reuse |
| `boundary-5` | 8 | 5 | Examine the estimated break-even region |
| `large-5` | 16 | 5 | Measure a long common prefix |
| `strong-5` | 48 | 5 | Measure a substantial shared prefix with conservative headroom |
| `unrelated-5` | 16 different products | 5 | Reject long tests without a useful common prefix |
| `medium-9` | 4 | 9 | Measure more consumers of a smaller prefix |
| `large-9` | 16 | 9 | Measure more consumers of a longer prefix |
| `deep-shallow` | 1–12 | 24 | Twelve nested shallow branch boundaries |
| `deep-large` | 6–72 | 36 | Twelve substantial boundaries and the checkpoint cap |

The default matrix contains `short-5`, `reuse-2`, `boundary-5`, `strong-5` and
`unrelated-5`, with three pairs per row.
Extended rows can be selected explicitly. All matrix runs use
`maxCheckpointsPerTest: 4`; the product default remains **9**. Both deep rows
contain more than nine candidates along a path. The cap limits selected
checkpoints, never the test actions or the number of tests. It is not a byte
limit: snapshot size still depends on the application and database.

## Required CI performance check

The normal PR CI runs **all ten rows, with three alternating pairs per row** on
`ubuntu-24.04`. Each job installs two isolated Mage-OS/Luma/Playwright environments,
calibrates on that CI machine through `--calibrate`, then freezes the measured
baseline for its timed pairs. Real checkout assertions, matching test inventories,
source/seed/PHP/browser parity and complete cleanup are required. The positive
workloads must actually create and restore checkpoints.

[`references.json`](references.json) contains only reviewed GitHub Actions
measurements. [`desktop-history.json`](desktop-history.json) preserves local
research results for context; CI never uses those numbers as a reference.
The first complete CI run produces reference candidates and fails with
`baseline-required` until its measurements are reviewed. It does not silently
accept the current implementation as its own performance reference.

CI fails when median setup, test or total time increases by more than 10% and
at least one second. Improvements of the same size or changed checkpoint counts
raise a warning to review and rebuild the matrix. A changed host/workload profile
requires a fresh reference. These thresholds are in [`ci-policy.json`](ci-policy.json);
functional failures always fail regardless of timing. References never update
automatically, and a regression cannot be averaged away.

After reviewing all ten artifacts from one commit, run and attempt, prepare a
replacement reference file from the downloaded artifacts:

```bash
node tests/performance/branching/ci-reference.cjs ARTIFACT_DIRECTORY COMMIT_SHA RUN_ID ATTEMPT .runtime/ci-reference.json
```

Review that file, replace `tests/performance/branching/references.json`, and rerun
the complete CI matrix against the updated candidate. Missing rows, failed runs
and mixed attempts cannot form a reference. Only bounded timing summaries and
provenance are uploaded; databases, credentials and raw test artifacts stay on
the disposable runner. This performance check supplements the release E2E and
coverage-equivalence gate; it does not establish branching application coverage.

## Prepare two disposable installations

Use two independently installed Docker projects with separate databases, Redis,
search, application files and networks. Configure both as Luma through the normal
installer theme configuration, with matching PHP settings, dependencies, service
limits and the pinned Playwright/Chrome versions. Their internal storefront URL
must match; separate Docker networks resolve it to the corresponding application.
The linear runner must be the normal Playwright image. Only the branching driver
receives the Docker socket and CoW storage.

`run.py` resets databases and sessions. It requires `--disposable` and an explicit
`.runtime/experience-owner.json` in each installation:

```json
{"purpose":"isolated branching experience validation","project":"YOUR_DOCKER_PROJECT"}
```

Create the fixture on the first disposable installation, using its Compose wrapper:

```bash
/work/linear/bin/application-compose exec -T -e MAGELENS_PERFORMANCE_DISPOSABLE=1 phpfpm php < tests/performance/branching/fixture.php
/work/linear/bin/application-compose exec -T phpfpm php bin/magento indexer:reindex
/work/linear/bin/application-compose exec -T phpfpm php bin/magento cache:flush
/work/linear/bin/application-compose exec -T db sh -c 'exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-comments --order-by-primary magento' > .runtime/performance-seed.sql
chmod 600 .runtime/performance-seed.sql
```

Save a private configuration file under `.runtime/`. Use absolute host paths;
the driver mounts them at the same paths inside Docker. Select existing prebuilt
orchestrator and branching Playwright images with the repository image commands.
`plannerBinary` is the current release build from the isolated Rust build container.

```json
{
  "linear": {"site":"/work/linear","project":"perf-linear","modules":"perf-linear_node_modules"},
  "branching": {"site":"/work/branching","project":"perf-branching"},
  "seed":"/work/magelens/.runtime/performance-seed.sql",
  "cowRoot":"/work/cow",
  "origin":"https://performance.test/",
  "coreImage":"YOUR_PREBUILT_ORCHESTRATOR_IMAGE",
  "branchingImage":"YOUR_PREBUILT_BRANCHING_PLAYWRIGHT_IMAGE",
  "plannerBinary":"/work/magelens/.runtime/rust-target/release/magelens-plan"
}
```

Both stacks must be stopped before measurement. The harness verifies service
isolation and configuration, probes the actual serving PHP-FPM configuration,
compares Chrome versions, restores the seed, rebuilds indexes, clears caches and
sessions, then verifies the database dump matches byte for byte. Resetting the
fixture is outside each timed sample and happens identically for both arms.

```bash
python3 tests/performance/branching/run.py \
  --config .runtime/performance-local.json \
  --output .runtime/performance-matrix-01 --disposable
```

Use `--rows strong-5,deep-shallow,deep-large --pairs 1` for a focused qualification.
Use a fresh output directory for every campaign. A failed test or preflight stops
the campaign; there are no automatic test retries. Recover any retained workflow
before another run. Reports and database seeds stay local under `.runtime/`.

## Interpret the results

The timing boundary is the first native setup test starting. **Setup** includes
service startup, planning, native collection and runner startup. **Tests** include
the setup test, all journeys, checkpoint preparation, capture, restoration,
validation, releases, cleanup and orchestrator teardown. **Total** is their sum.
Application service shutdown after the sample is excluded equally from both arms.
Pair order alternates linear/branching and branching/linear.

An accepted pair needs identical test inventories, source, seed, PHP configuration
and browser, every test passing, zero fallback, and successful checkpoint cleanup.
The report retains driver/browser cgroup memory peaks, planner peaks, per-action
native timings and checkpoint operation timings. Cgroup peaks include file cache;
they are not JavaScript heap measurements or a summed peak for the whole stack.

Checkpoint break-even depends on reuse: avoided repeated work must exceed
preparation, capture, all restorations and cleanup, multiplied by **2 × 1.20**.
The original shared prefix still runs once. Short work may become useful when many tests reuse it. Nested checkpoints
must not claim the same saving twice. Use complete paired test time to confirm a
benefit; do not subtract checkpoint overhead from it.

## Project baseline and overhead history

Fresh projects use the root [checkpoint decision baseline](../../../branching-baseline.json).
It represents the estimated break-even repeated work for two tests sharing one
checkpoint. The internal operation proportions and source-work weights remain
versioned; calibration replaces operation estimates with project measurements. After a successful suite with
real checkpoints, zero fallbacks and verified cleanup, the orchestrator saves
weighted averages of the measured checkpoint operations for subsequent runs.
It adds no extra calibration work during ordinary tests and keeps the current
run's planning baseline unchanged. Runs without checkpoints cannot update costs.

Set `baseline: {updateOnSuccess: false}` in the project configuration to keep
updates explicit. The project-setup calibration command works in either mode:

```bash
./bin/run-coverage --branching --disposable --calibrate MANIFEST.json CONFIG.cjs COW_STORAGE
```

It measures three real capture/restore cycles, validates restored state and
cleans up, then replaces the project's averages. Use the same manifest, project
configuration and disposable installation as an AUTO run. It does not execute
the test suite. Changing the database-size cohort, hardware, service images or
relevant configuration starts from the defaults again.

The current averages live in `.runtime/branching-baseline.json`. Append-only
`.runtime/branching-baseline-history.ndjson` retains each successful observation,
the previous baseline, the resulting baseline and regression warnings. Each new
measurement is compared with the original reference before averaging. The
default warning threshold is an increase greater than 10% and at least 10 ms;
`baseline.regressionThreshold` can change the percentage. Explicit recalibration
compares against the old reference before establishing a new one. History remains
available across recalibration and configuration changes.

The displayed decision baseline includes backend setup/cleanup, the first reset,
capture, one restore and release, with 2× overhead plus 20% headroom and a 50 ms
minimum saving. Fanout and nested graphs use the complete operation model;
the two-test value is a summary, not a universal per-test cutoff. Calibration
changes the project measurements, not the tracked root default.
